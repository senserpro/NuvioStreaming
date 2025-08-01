import React, { useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, Dimensions, Animated, ActivityIndicator, Platform, NativeModules, StatusBar, Text } from 'react-native';
import Video, { VideoRef, SelectedTrack, SelectedTrackType, BufferingStrategyType } from 'react-native-video';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { PinchGestureHandler, State, PinchGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import RNImmersiveMode from 'react-native-immersive-mode';
import * as ScreenOrientation from 'expo-screen-orientation';
import { storageService } from '../../services/storageService';
import { logger } from '../../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useTraktAutosync } from '../../hooks/useTraktAutosync';

import { 
  DEFAULT_SUBTITLE_SIZE, 
  AudioTrack,
  TextTrack,
  ResizeModeType, 
  WyzieSubtitle, 
  SubtitleCue,
  RESUME_PREF_KEY,
  RESUME_PREF,
  SUBTITLE_SIZE_KEY
} from './utils/playerTypes';
import { safeDebugLog, parseSRT, DEBUG_MODE, formatTime } from './utils/playerUtils';
import { styles } from './utils/playerStyles';
import SubtitleModals from './modals/SubtitleModals';
import AudioTrackModal from './modals/AudioTrackModal';
import ResumeOverlay from './modals/ResumeOverlay';
import PlayerControls from './controls/PlayerControls';
import CustomSubtitles from './subtitles/CustomSubtitles';
import SourcesModal from './modals/SourcesModal';

// Map VLC resize modes to react-native-video resize modes
const getVideoResizeMode = (resizeMode: ResizeModeType) => {
  switch (resizeMode) {
    case 'contain': return 'contain';
    case 'cover': return 'cover';
    case 'stretch': return 'stretch';
    case 'none': return 'contain';
    default: return 'contain';
  }
};

const AndroidVideoPlayer: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Player'>>();
  
  const {
    uri,
    title = 'Episode Name',
    season,
    episode,
    episodeTitle,
    quality,
    year,
    streamProvider,
    streamName,
    id,
    type,
    episodeId,
    imdbId,
    availableStreams: passedAvailableStreams
  } = route.params;

  // Initialize Trakt autosync
  const traktAutosync = useTraktAutosync({
    id: id || '',
    type: type === 'series' ? 'series' : 'movie',
    title: episodeTitle || title,
    year: year || 0,
    imdbId: imdbId || '',
    season: season,
    episode: episode,
    showTitle: title,
    showYear: year,
    showImdbId: imdbId,
    episodeId: episodeId
  });

  safeDebugLog("Android Component mounted with props", {
    uri, title, season, episode, episodeTitle, quality, year,
    streamProvider, id, type, episodeId, imdbId
  });

  const screenData = Dimensions.get('screen');
  const [screenDimensions, setScreenDimensions] = useState(screenData);

  const [paused, setPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number | null>(null);
  const [textTracks, setTextTracks] = useState<TextTrack[]>([]);
  const [selectedTextTrack, setSelectedTextTrack] = useState<number>(-1);
  const [resizeMode, setResizeMode] = useState<ResizeModeType>('stretch');
  const [buffered, setBuffered] = useState(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const videoRef = useRef<VideoRef>(null);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [initialPosition, setInitialPosition] = useState<number | null>(null);
  const [progressSaveInterval, setProgressSaveInterval] = useState<NodeJS.Timeout | null>(null);
  const [isInitialSeekComplete, setIsInitialSeekComplete] = useState(false);
  const [showResumeOverlay, setShowResumeOverlay] = useState(false);
  const [resumePosition, setResumePosition] = useState<number | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [resumePreference, setResumePreference] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [isOpeningAnimationComplete, setIsOpeningAnimationComplete] = useState(false);
  const openingFadeAnim = useRef(new Animated.Value(0)).current;
  const openingScaleAnim = useRef(new Animated.Value(0.8)).current;
  const backgroundFadeAnim = useRef(new Animated.Value(1)).current;
  const [isBuffering, setIsBuffering] = useState(false);
  const [rnVideoAudioTracks, setRnVideoAudioTracks] = useState<Array<{id: number, name: string, language?: string}>>([]);
  const [rnVideoTextTracks, setRnVideoTextTracks] = useState<Array<{id: number, name: string, language?: string}>>([]);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressBarRef = useRef<View>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isSeeking = useRef(false);
  const seekDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingSeekValue = useRef<number | null>(null);
  const lastSeekTime = useRef<number>(0);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [is16by9Content, setIs16by9Content] = useState(false);
  const [customVideoStyles, setCustomVideoStyles] = useState<any>({});
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomTranslateX, setZoomTranslateX] = useState(0);
  const [zoomTranslateY, setZoomTranslateY] = useState(0);
  const [lastZoomScale, setLastZoomScale] = useState(1);
  const [lastTranslateX, setLastTranslateX] = useState(0);
  const [lastTranslateY, setLastTranslateY] = useState(0);
  const pinchRef = useRef<PinchGestureHandler>(null);
  const [customSubtitles, setCustomSubtitles] = useState<SubtitleCue[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');
  const [subtitleSize, setSubtitleSize] = useState<number>(DEFAULT_SUBTITLE_SIZE);
  const [useCustomSubtitles, setUseCustomSubtitles] = useState<boolean>(false);
  const [isLoadingSubtitles, setIsLoadingSubtitles] = useState<boolean>(false);
  const [availableSubtitles, setAvailableSubtitles] = useState<WyzieSubtitle[]>([]);
  const [showSubtitleLanguageModal, setShowSubtitleLanguageModal] = useState<boolean>(false);
  const [isLoadingSubtitleList, setIsLoadingSubtitleList] = useState<boolean>(false);
  const [showSourcesModal, setShowSourcesModal] = useState<boolean>(false);
  const [availableStreams, setAvailableStreams] = useState<{ [providerId: string]: { streams: any[]; addonName: string } }>(passedAvailableStreams || {});
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string>(uri);
  const [isChangingSource, setIsChangingSource] = useState<boolean>(false);
  const [pendingSeek, setPendingSeek] = useState<{ position: number; shouldPlay: boolean } | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string | undefined>(quality);
  const [currentStreamProvider, setCurrentStreamProvider] = useState<string | undefined>(streamProvider);
  const [currentStreamName, setCurrentStreamName] = useState<string | undefined>(streamName);
  const isMounted = useRef(true);

  const calculateVideoStyles = (videoWidth: number, videoHeight: number, screenWidth: number, screenHeight: number) => {
    return {
      position: 'absolute',
      top: 0,
      left: 0,
      width: screenWidth,
      height: screenHeight,
    };
  };

  const onPinchGestureEvent = (event: PinchGestureHandlerGestureEvent) => {
    const { scale } = event.nativeEvent;
    const newScale = Math.max(1, Math.min(lastZoomScale * scale, 1.1));
    setZoomScale(newScale);
    if (DEBUG_MODE) {
      logger.log(`[AndroidVideoPlayer] Center Zoom: ${newScale.toFixed(2)}x`);
    }
  };

  const onPinchHandlerStateChange = (event: PinchGestureHandlerGestureEvent) => {
    if (event.nativeEvent.state === State.END) {
      setLastZoomScale(zoomScale);
      if (DEBUG_MODE) {
        logger.log(`[AndroidVideoPlayer] Pinch ended - saved scale: ${zoomScale.toFixed(2)}x`);
      }
    }
  };

  const resetZoom = () => {
    const targetZoom = is16by9Content ? 1.1 : 1;
    setZoomScale(targetZoom);
    setLastZoomScale(targetZoom);
    if (DEBUG_MODE) {
      logger.log(`[AndroidVideoPlayer] Zoom reset to ${targetZoom}x (16:9: ${is16by9Content})`);
    }
  };

  useEffect(() => {
    if (videoAspectRatio && screenDimensions.width > 0 && screenDimensions.height > 0) {
      const styles = calculateVideoStyles(
        videoAspectRatio * 1000,
        1000,
        screenDimensions.width,
        screenDimensions.height
      );
      setCustomVideoStyles(styles);
      if (DEBUG_MODE) {
        logger.log(`[AndroidVideoPlayer] Screen dimensions changed, recalculated styles:`, styles);
      }
    }
  }, [screenDimensions, videoAspectRatio]);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ screen }) => {
      setScreenDimensions(screen);
    });
    const initializePlayer = () => {
      StatusBar.setHidden(true, 'none');
      enableImmersiveMode();
      startOpeningAnimation();
    };
    initializePlayer();
    return () => {
      subscription?.remove();
      const unlockOrientation = async () => {
        await ScreenOrientation.unlockAsync();
      };
      unlockOrientation();
      disableImmersiveMode();
    };
  }, []);

  const startOpeningAnimation = () => {
    // Animation logic here
  };

  const completeOpeningAnimation = () => {
    Animated.parallel([
      Animated.timing(openingFadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(openingScaleAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(backgroundFadeAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start(() => {
      openingScaleAnim.setValue(1);
      openingFadeAnim.setValue(1);
      setIsOpeningAnimationComplete(true);
      setTimeout(() => {
        backgroundFadeAnim.setValue(0);
      }, 100);
    });
  };

  useEffect(() => {
    const loadWatchProgress = async () => {
      if (id && type) {
        try {
          logger.log(`[AndroidVideoPlayer] Loading watch progress for ${type}:${id}${episodeId ? `:${episodeId}` : ''}`);
          const savedProgress = await storageService.getWatchProgress(id, type, episodeId);
          logger.log(`[AndroidVideoPlayer] Saved progress:`, savedProgress);
          
          if (savedProgress) {
            const progressPercent = (savedProgress.currentTime / savedProgress.duration) * 100;
            logger.log(`[AndroidVideoPlayer] Progress: ${progressPercent.toFixed(1)}% (${savedProgress.currentTime}/${savedProgress.duration})`);
            
            if (progressPercent < 85) {
              setResumePosition(savedProgress.currentTime);
              logger.log(`[AndroidVideoPlayer] Set resume position to: ${savedProgress.currentTime}`);
              
              const pref = await AsyncStorage.getItem(RESUME_PREF_KEY);
              logger.log(`[AndroidVideoPlayer] Resume preference: ${pref}`);
              
              if (pref === RESUME_PREF.ALWAYS_RESUME) {
                setInitialPosition(savedProgress.currentTime);
                logger.log(`[AndroidVideoPlayer] Auto-resuming due to preference`);
              } else if (pref === RESUME_PREF.ALWAYS_START_OVER) {
                setInitialPosition(0);
                logger.log(`[AndroidVideoPlayer] Auto-starting over due to preference`);
              } else {
                setShowResumeOverlay(true);
                logger.log(`[AndroidVideoPlayer] Showing resume overlay`);
              }
            } else {
              logger.log(`[AndroidVideoPlayer] Progress too high (${progressPercent.toFixed(1)}%), not showing resume overlay`);
            }
          } else {
            logger.log(`[AndroidVideoPlayer] No saved progress found`);
          }
        } catch (error) {
          logger.error('[AndroidVideoPlayer] Error loading watch progress:', error);
        }
      } else {
        logger.log(`[AndroidVideoPlayer] Missing id or type: id=${id}, type=${type}`);
      }
    };
    loadWatchProgress();
  }, [id, type, episodeId]);

  const saveWatchProgress = async () => {
    if (id && type && currentTime > 0 && duration > 0) {
      const progress = {
        currentTime,
        duration,
        lastUpdated: Date.now()
      };
      try {
        await storageService.setWatchProgress(id, type, progress, episodeId);
        
        // Sync to Trakt if authenticated
        await traktAutosync.handleProgressUpdate(currentTime, duration);
      } catch (error) {
        logger.error('[AndroidVideoPlayer] Error saving watch progress:', error);
      }
    }
  };
    
  useEffect(() => {
    if (id && type && !paused && duration > 0) {
      if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
      }
      const interval = setInterval(() => {
        saveWatchProgress();
      }, 5000);
      setProgressSaveInterval(interval);
      return () => {
        clearInterval(interval);
        setProgressSaveInterval(null);
      };
    }
  }, [id, type, paused, currentTime, duration]);

  useEffect(() => {
    return () => {
      if (id && type && duration > 0) {
        saveWatchProgress();
        // Final Trakt sync on component unmount
        traktAutosync.handlePlaybackEnd(currentTime, duration, 'unmount');
      }
    };
  }, [id, type, currentTime, duration]);

  const seekToTime = (timeInSeconds: number) => {
    if (videoRef.current && duration > 0 && !isSeeking.current) {
      if (DEBUG_MODE) {
        logger.log(`[AndroidVideoPlayer] Seeking to ${timeInSeconds.toFixed(2)}s`);
      }
      
      isSeeking.current = true;
      setSeekTime(timeInSeconds);
      
      // Clear seek state after seek
      setTimeout(() => {
        if (isMounted.current) {
          setSeekTime(null);
          isSeeking.current = false;
        }
      }, 100);
    } else {
      if (DEBUG_MODE) {
        logger.error('[AndroidVideoPlayer] Seek failed: Player not ready, duration is zero, or already seeking.');
      }
    }
  };

  // Handle seeking when seekTime changes
  useEffect(() => {
    if (seekTime !== null && videoRef.current && duration > 0) {
      videoRef.current.seek(seekTime);
    }
  }, [seekTime, duration]);

  const handleProgressBarTouch = (event: any) => {
    if (duration > 0) {
      const { locationX } = event.nativeEvent;
      processProgressTouch(locationX);
    }
  };
  
  const handleProgressBarDragStart = () => {
    setIsDragging(true);
  };
  
  const handleProgressBarDragMove = (event: any) => {
    if (!isDragging || !duration || duration <= 0) return;
    const { locationX } = event.nativeEvent;
    processProgressTouch(locationX, true);
  };
  
  const handleProgressBarDragEnd = () => {
    setIsDragging(false);
    if (pendingSeekValue.current !== null) {
      seekToTime(pendingSeekValue.current);
      pendingSeekValue.current = null;
    }
  };
  
  const processProgressTouch = (locationX: number, isDragging = false) => {
    progressBarRef.current?.measure((x, y, width, height, pageX, pageY) => {
      const percentage = Math.max(0, Math.min(locationX / width, 1));
      const seekTime = percentage * duration;
      progressAnim.setValue(percentage);
      if (isDragging) {
        pendingSeekValue.current = seekTime;
        setCurrentTime(seekTime);
      } else {
        seekToTime(seekTime);
      }
    });
  };

  const handleProgress = (data: any) => {
    if (isDragging || isSeeking.current) return;
    
    const currentTimeInSeconds = data.currentTime;
    
    // Only update if there's a significant change to avoid unnecessary updates
    if (Math.abs(currentTimeInSeconds - currentTime) > 0.5) {
      safeSetState(() => setCurrentTime(currentTimeInSeconds));
      const progressPercent = duration > 0 ? currentTimeInSeconds / duration : 0;
      Animated.timing(progressAnim, {
        toValue: progressPercent,
        duration: 250,
        useNativeDriver: false,
      }).start();
      const bufferedTime = data.playableDuration || currentTimeInSeconds;
      safeSetState(() => setBuffered(bufferedTime));
    }
  };

  const onLoad = (data: any) => {
    if (DEBUG_MODE) {
      logger.log('[AndroidVideoPlayer] Video loaded:', data);
    }
    if (isMounted.current) {
      const videoDuration = data.duration;
      if (data.duration > 0) {
        setDuration(videoDuration);
      }
      
      // Set aspect ratio from video dimensions
      if (data.naturalSize && data.naturalSize.width && data.naturalSize.height) {
        setVideoAspectRatio(data.naturalSize.width / data.naturalSize.height);
      }

      // Handle audio tracks
      if (data.audioTracks && data.audioTracks.length > 0) {
        const formattedAudioTracks = data.audioTracks.map((track: any, index: number) => ({
          id: track.index || index,
          name: track.title || track.language || `Audio ${index + 1}`,
          language: track.language,
        }));
        setRnVideoAudioTracks(formattedAudioTracks);
      }

      // Handle text tracks
      if (data.textTracks && data.textTracks.length > 0) {
        const formattedTextTracks = data.textTracks.map((track: any, index: number) => ({
          id: track.index || index,
          name: track.title || track.language || `Subtitle ${index + 1}`,
          language: track.language,
        }));
        setRnVideoTextTracks(formattedTextTracks);
      }

      setIsVideoLoaded(true);
      setIsPlayerReady(true);
      
      // Start Trakt watching session when video loads with proper duration
      if (videoDuration > 0) {
        traktAutosync.handlePlaybackStart(currentTime, videoDuration);
      }
      
      if (initialPosition && !isInitialSeekComplete) {
        logger.log(`[AndroidVideoPlayer] Seeking to initial position: ${initialPosition}s (duration: ${videoDuration}s)`);
        setTimeout(() => {
          if (videoRef.current && videoDuration > 0 && isMounted.current) {
            seekToTime(initialPosition);
            setIsInitialSeekComplete(true);
            logger.log(`[AndroidVideoPlayer] Initial seek completed to: ${initialPosition}s`);
          } else {
            logger.error(`[AndroidVideoPlayer] Initial seek failed: videoRef=${!!videoRef.current}, duration=${videoDuration}, mounted=${isMounted.current}`);
          }
        }, 1000);
      }
      completeOpeningAnimation();
    }
  };

  const skip = (seconds: number) => {
    if (videoRef.current) {
      const newTime = Math.max(0, Math.min(currentTime + seconds, duration));
      seekToTime(newTime);
    }
  };

  const cycleAspectRatio = () => {
    const newZoom = zoomScale === 1.1 ? 1 : 1.1;
    setZoomScale(newZoom);
    setZoomTranslateX(0);
    setZoomTranslateY(0);
    setLastZoomScale(newZoom);
    setLastTranslateX(0);
    setLastTranslateY(0);
  };

  const enableImmersiveMode = () => {
    StatusBar.setHidden(true, 'none');
    if (Platform.OS === 'android') {
      try {
        RNImmersiveMode.setBarMode('FullSticky');
        RNImmersiveMode.fullLayout(true);
        if (NativeModules.StatusBarManager) {
          NativeModules.StatusBarManager.setHidden(true);
        }
      } catch (error) {
        console.log('Immersive mode error:', error);
      }
    }
  };

  const disableImmersiveMode = () => {
    StatusBar.setHidden(false);
    if (Platform.OS === 'android') {
      RNImmersiveMode.setBarMode('Normal');
      RNImmersiveMode.fullLayout(false);
    }
  };

  const handleClose = () => {
    logger.log('[AndroidVideoPlayer] Close button pressed - syncing to Trakt before closing');
    logger.log(`[AndroidVideoPlayer] Current progress: ${currentTime}/${duration} (${duration > 0 ? ((currentTime / duration) * 100).toFixed(1) : 0}%)`);
    
    // Sync progress to Trakt before closing
    traktAutosync.handlePlaybackEnd(currentTime, duration, 'unmount');
    
    // Start exit animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(openingFadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Small delay to allow animation to start, then unlock orientation and navigate
    setTimeout(() => {
      ScreenOrientation.unlockAsync().then(() => {
        disableImmersiveMode();
        navigation.goBack();
      }).catch(() => {
        // Fallback: navigate even if orientation unlock fails
        disableImmersiveMode();
        navigation.goBack();
      });
    }, 100);
  };
    
  useEffect(() => {
    const loadResumePreference = async () => {
      try {
        logger.log(`[AndroidVideoPlayer] Loading resume preference, resumePosition=${resumePosition}`);
        const pref = await AsyncStorage.getItem(RESUME_PREF_KEY);
        logger.log(`[AndroidVideoPlayer] Resume preference loaded: ${pref}`);
        
        if (pref) {
          setResumePreference(pref);
          if (pref === RESUME_PREF.ALWAYS_RESUME && resumePosition !== null) {
            logger.log(`[AndroidVideoPlayer] Auto-resuming due to preference`);
            setShowResumeOverlay(false);
            setInitialPosition(resumePosition);
          } else if (pref === RESUME_PREF.ALWAYS_START_OVER) {
            logger.log(`[AndroidVideoPlayer] Auto-starting over due to preference`);
            setShowResumeOverlay(false);
            setInitialPosition(0);
          }
          // Don't override overlay if no specific preference or preference doesn't match
        } else {
          logger.log(`[AndroidVideoPlayer] No resume preference found, keeping overlay state`);
        }
      } catch (error) {
        logger.error('[AndroidVideoPlayer] Error loading resume preference:', error);
      }
    };
    loadResumePreference();
  }, [resumePosition]);

  const resetResumePreference = async () => {
    try {
      await AsyncStorage.removeItem(RESUME_PREF_KEY);
      setResumePreference(null);
    } catch (error) {
      logger.error('[AndroidVideoPlayer] Error resetting resume preference:', error);
    }
  };

  const handleResume = async () => {
    if (resumePosition !== null && videoRef.current) {
      if (rememberChoice) {
        try {
          await AsyncStorage.setItem(RESUME_PREF_KEY, RESUME_PREF.ALWAYS_RESUME);
        } catch (error) {
          logger.error('[AndroidVideoPlayer] Error saving resume preference:', error);
        }
      }
      setInitialPosition(resumePosition);
      setShowResumeOverlay(false);
      setTimeout(() => {
        if (videoRef.current) {
          seekToTime(resumePosition);
        }
      }, 500);
    }
  };

  const handleStartFromBeginning = async () => {
    if (rememberChoice) {
      try {
        await AsyncStorage.setItem(RESUME_PREF_KEY, RESUME_PREF.ALWAYS_START_OVER);
      } catch (error) {
        logger.error('[AndroidVideoPlayer] Error saving resume preference:', error);
      }
    }
    setShowResumeOverlay(false);
    setInitialPosition(0);
    if (videoRef.current) {
      seekToTime(0);
      setCurrentTime(0);
    }
  };

  const toggleControls = () => {
    setShowControls(previousState => !previousState);
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: showControls ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [showControls]);

  const handleError = (error: any) => {
    logger.error('[AndroidVideoPlayer] Playback Error:', error);
  };

  const onBuffer = (data: any) => {
    setIsBuffering(data.isBuffering);
  };

  const onEnd = () => {
    // Sync final progress to Trakt
    traktAutosync.handlePlaybackEnd(currentTime, duration, 'ended');
  };

  const selectAudioTrack = (trackId: number) => {
    setSelectedAudioTrack(trackId);
  };

  const selectTextTrack = (trackId: number) => {
    if (trackId === -999) {
      setUseCustomSubtitles(true);
      setSelectedTextTrack(-1);
    } else {
      setUseCustomSubtitles(false);
      setSelectedTextTrack(trackId);
    }
  };
  
  const loadSubtitleSize = async () => {
    try {
      const savedSize = await AsyncStorage.getItem(SUBTITLE_SIZE_KEY);
      if (savedSize) {
        setSubtitleSize(parseInt(savedSize, 10));
      }
    } catch (error) {
      logger.error('[AndroidVideoPlayer] Error loading subtitle size:', error);
    }
  };

  const saveSubtitleSize = async (size: number) => {
    try {
      await AsyncStorage.setItem(SUBTITLE_SIZE_KEY, size.toString());
      setSubtitleSize(size);
    } catch (error) {
      logger.error('[AndroidVideoPlayer] Error saving subtitle size:', error);
    }
  };

  const fetchAvailableSubtitles = async (imdbIdParam?: string, autoSelectEnglish = false) => {
    const targetImdbId = imdbIdParam || imdbId;
    if (!targetImdbId) {
      logger.error('[AndroidVideoPlayer] No IMDb ID available for subtitle search');
      return;
    }
    setIsLoadingSubtitleList(true);
    try {
      let searchUrl = `https://sub.wyzie.ru/search?id=${targetImdbId}&encoding=utf-8&source=all`;
      if (season && episode) {
        searchUrl += `&season=${season}&episode=${episode}`;
      }
      const response = await fetch(searchUrl);
      const subtitles: WyzieSubtitle[] = await response.json();
      const uniqueSubtitles = subtitles.reduce((acc, current) => {
        const exists = acc.find(item => item.language === current.language);
        if (!exists) {
          acc.push(current);
        }
        return acc;
      }, [] as WyzieSubtitle[]);
      uniqueSubtitles.sort((a, b) => a.display.localeCompare(b.display));
      setAvailableSubtitles(uniqueSubtitles);
      if (autoSelectEnglish) {
        const englishSubtitle = uniqueSubtitles.find(sub => 
          sub.language.toLowerCase() === 'eng' || 
          sub.language.toLowerCase() === 'en' ||
          sub.display.toLowerCase().includes('english')
        );
        if (englishSubtitle) {
          loadWyzieSubtitle(englishSubtitle);
          return;
        }
      }
      if (!autoSelectEnglish) {
        setShowSubtitleLanguageModal(true);
      }
    } catch (error) {
      logger.error('[AndroidVideoPlayer] Error fetching subtitles from Wyzie API:', error);
    } finally {
      setIsLoadingSubtitleList(false);
    }
  };

  const loadWyzieSubtitle = async (subtitle: WyzieSubtitle) => {
    setShowSubtitleLanguageModal(false);
    setIsLoadingSubtitles(true);
    try {
      const response = await fetch(subtitle.url);
      const srtContent = await response.text();
      const parsedCues = parseSRT(srtContent);
      setCustomSubtitles(parsedCues);
      setUseCustomSubtitles(true);
      setSelectedTextTrack(-1);
    } catch (error) {
      logger.error('[AndroidVideoPlayer] Error loading Wyzie subtitle:', error);
    } finally {
      setIsLoadingSubtitles(false);
    }
  };
    
  const togglePlayback = () => {
    if (videoRef.current) {
        setPaused(!paused);
    }
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (seekDebounceTimer.current) {
        clearTimeout(seekDebounceTimer.current);
      }
    };
  }, []);
  
  const safeSetState = (setter: any) => {
    if (isMounted.current) {
      setter();
    }
  };

  useEffect(() => {
    if (!useCustomSubtitles || customSubtitles.length === 0) {
      if (currentSubtitle !== '') {
        setCurrentSubtitle('');
      }
      return;
    }
    const currentCue = customSubtitles.find(cue => 
      currentTime >= cue.start && currentTime <= cue.end
    );
    const newSubtitle = currentCue ? currentCue.text : '';
    setCurrentSubtitle(newSubtitle);
  }, [currentTime, customSubtitles, useCustomSubtitles]);

  useEffect(() => {
    loadSubtitleSize();
  }, []);

  const increaseSubtitleSize = () => {
    const newSize = Math.min(subtitleSize + 2, 32);
    saveSubtitleSize(newSize);
  };

  const decreaseSubtitleSize = () => {
    const newSize = Math.max(subtitleSize - 2, 8);
    saveSubtitleSize(newSize);
  };

  useEffect(() => {
    if (pendingSeek && isPlayerReady && isVideoLoaded && duration > 0) {
      logger.log(`[AndroidVideoPlayer] Player ready after source change, seeking to position: ${pendingSeek.position}s out of ${duration}s total`);
      
      if (pendingSeek.position > 0 && videoRef.current) {
        const delayTime = 800; // Shorter delay for react-native-video
        
        setTimeout(() => {
          if (videoRef.current && duration > 0 && pendingSeek) {
            logger.log(`[AndroidVideoPlayer] Executing seek to ${pendingSeek.position}s`);
            
            seekToTime(pendingSeek.position);
            
            if (pendingSeek.shouldPlay) {
              setTimeout(() => {
                logger.log('[AndroidVideoPlayer] Resuming playback after source change seek');
                setPaused(false);
              }, 300);
            }
            
            setTimeout(() => {
              setPendingSeek(null);
              setIsChangingSource(false);
            }, 400);
          }
        }, delayTime);
      } else {
        // No seeking needed, just resume playback if it was playing
        if (pendingSeek.shouldPlay) {
          setTimeout(() => {
            logger.log('[AndroidVideoPlayer] No seek needed, just resuming playback');
            setPaused(false);
          }, 300);
        }
        
        setTimeout(() => {
          setPendingSeek(null);
          setIsChangingSource(false);
        }, 400);
      }
    }
  }, [pendingSeek, isPlayerReady, isVideoLoaded, duration]);

  const handleSelectStream = async (newStream: any) => {
    if (newStream.url === currentStreamUrl) {
      setShowSourcesModal(false);
      return;
    }

    setIsChangingSource(true);
    setShowSourcesModal(false);
    
    try {
      // Save current state
      const savedPosition = currentTime;
      const wasPlaying = !paused;
      
      logger.log(`[AndroidVideoPlayer] Changing source from ${currentStreamUrl} to ${newStream.url}`);
      logger.log(`[AndroidVideoPlayer] Saved position: ${savedPosition}, was playing: ${wasPlaying}`);
      
      // Extract quality and provider information from the new stream
      let newQuality = newStream.quality;
      if (!newQuality && newStream.title) {
        // Try to extract quality from title (e.g., "1080p", "720p")
        const qualityMatch = newStream.title.match(/(\d+)p/);
        newQuality = qualityMatch ? qualityMatch[0] : undefined;
      }
      
      // For provider, try multiple fields
      const newProvider = newStream.addonName || newStream.name || newStream.addon || 'Unknown';
      
      // For stream name, prioritize the stream name over title
      const newStreamName = newStream.name || newStream.title || 'Unknown Stream';
      
      logger.log(`[AndroidVideoPlayer] Stream object:`, newStream);
      logger.log(`[AndroidVideoPlayer] Extracted - Quality: ${newQuality}, Provider: ${newProvider}, Stream Name: ${newStreamName}`);
      
      // Stop current playback
      setPaused(true);
      
      // Set pending seek state
      setPendingSeek({ position: savedPosition, shouldPlay: wasPlaying });
      
      // Update the stream URL and details immediately
      setCurrentStreamUrl(newStream.url);
      setCurrentQuality(newQuality);
      setCurrentStreamProvider(newProvider);
      setCurrentStreamName(newStreamName);
      
      // Reset player state for new source
      setCurrentTime(0);
      setDuration(0);
      setIsPlayerReady(false);
      setIsVideoLoaded(false);
      
    } catch (error) {
      logger.error('[AndroidVideoPlayer] Error changing source:', error);
      setPendingSeek(null);
      setIsChangingSource(false);
    }
  };

  return (
    <View style={[styles.container, {
      width: screenDimensions.width,
      height: screenDimensions.height,
      position: 'absolute',
      top: 0,
      left: 0,
    }]}> 
      <Animated.View 
        style={[
          styles.openingOverlay,
          {
            opacity: backgroundFadeAnim,
            zIndex: isOpeningAnimationComplete ? -1 : 3000,
            width: screenDimensions.width,
            height: screenDimensions.height,
          }
        ]}
        pointerEvents={isOpeningAnimationComplete ? 'none' : 'auto'}
      >
        <TouchableOpacity 
          style={styles.loadingCloseButton}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <MaterialIcons name="close" size={24} color="#ffffff" />
        </TouchableOpacity>
        
        <View style={styles.openingContent}>
          <ActivityIndicator size="large" color="#E50914" />
          <Text style={styles.openingText}>Loading video...</Text>
        </View>
      </Animated.View>

      {/* Source Change Loading Overlay */}
      {isChangingSource && (
        <Animated.View 
          style={[
            styles.sourceChangeOverlay,
            {
              width: screenDimensions.width,
              height: screenDimensions.height,
              opacity: fadeAnim,
            }
          ]}
          pointerEvents="auto"
        >
          <View style={styles.sourceChangeContent}>
            <ActivityIndicator size="large" color="#E50914" />
            <Text style={styles.sourceChangeText}>Changing source...</Text>
            <Text style={styles.sourceChangeSubtext}>Please wait while we load the new stream</Text>
          </View>
        </Animated.View>
      )}

      <Animated.View 
        style={[
          styles.videoPlayerContainer,
          {
            opacity: openingFadeAnim,
            transform: isOpeningAnimationComplete ? [] : [{ scale: openingScaleAnim }],
            width: screenDimensions.width,
            height: screenDimensions.height,
          }
        ]}
      >
        <TouchableOpacity
          style={[styles.videoContainer, {
            width: screenDimensions.width,
            height: screenDimensions.height,
          }]}
          onPress={toggleControls}
          activeOpacity={1}
        >
          <PinchGestureHandler
            ref={pinchRef}
            onGestureEvent={onPinchGestureEvent}
            onHandlerStateChange={onPinchHandlerStateChange}
          >
            <View style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenDimensions.width,
              height: screenDimensions.height,
            }}>
              <TouchableOpacity
                style={{ flex: 1 }}
                activeOpacity={1}
                onPress={toggleControls}
                onLongPress={resetZoom}
                delayLongPress={300}
              >
                <Video
                  ref={videoRef}
                  style={[styles.video, customVideoStyles, { transform: [{ scale: zoomScale }] }]}
                  source={{ uri: currentStreamUrl }}
                  paused={paused}
                  onProgress={handleProgress}
                  onLoad={onLoad}
                  onEnd={onEnd}
                  onError={handleError}
                  onBuffer={onBuffer}
                  resizeMode={getVideoResizeMode(resizeMode)}
                  selectedAudioTrack={selectedAudioTrack !== null ? { type: SelectedTrackType.INDEX, value: selectedAudioTrack } : undefined}
                  selectedTextTrack={useCustomSubtitles ? { type: SelectedTrackType.DISABLED } : (selectedTextTrack >= 0 ? { type: SelectedTrackType.INDEX, value: selectedTextTrack } : undefined)}
                  rate={1.0}
                  volume={1.0}
                  muted={false}
                  repeat={false}
                  playInBackground={false}
                  playWhenInactive={false}
                  ignoreSilentSwitch="ignore"
                  mixWithOthers="inherit"
                  progressUpdateInterval={1000}
                />
              </TouchableOpacity>
            </View>
          </PinchGestureHandler>

          <PlayerControls
            showControls={showControls}
            fadeAnim={fadeAnim}
            paused={paused}
            title={title}
            episodeTitle={episodeTitle}
            season={season}
            episode={episode}
            quality={currentQuality || quality}
            year={year}
            streamProvider={currentStreamProvider || streamProvider}
            streamName={currentStreamName}
            currentTime={currentTime}
            duration={duration}
            zoomScale={zoomScale}
            vlcAudioTracks={rnVideoAudioTracks}
            selectedAudioTrack={selectedAudioTrack}
            availableStreams={availableStreams}
            togglePlayback={togglePlayback}
            skip={skip}
            handleClose={handleClose}
            cycleAspectRatio={cycleAspectRatio}
            setShowAudioModal={setShowAudioModal}
            setShowSubtitleModal={setShowSubtitleModal}
            setShowSourcesModal={setShowSourcesModal}
            progressBarRef={progressBarRef}
            progressAnim={progressAnim}
            handleProgressBarTouch={handleProgressBarTouch}
            handleProgressBarDragStart={handleProgressBarDragStart}
            handleProgressBarDragMove={handleProgressBarDragMove}
            handleProgressBarDragEnd={handleProgressBarDragEnd}
            buffered={buffered}
            formatTime={formatTime}
          />
          
          <CustomSubtitles
            useCustomSubtitles={useCustomSubtitles}
            currentSubtitle={currentSubtitle}
            subtitleSize={subtitleSize}
          />

          <ResumeOverlay
            showResumeOverlay={showResumeOverlay}
            resumePosition={resumePosition}
            duration={duration}
            title={title}
            season={season}
            episode={episode}
            rememberChoice={rememberChoice}
            setRememberChoice={setRememberChoice}
            resumePreference={resumePreference}
            resetResumePreference={resetResumePreference}
            handleResume={handleResume}
            handleStartFromBeginning={handleStartFromBeginning}
          />
        </TouchableOpacity> 
      </Animated.View>

      <AudioTrackModal
        showAudioModal={showAudioModal}
        setShowAudioModal={setShowAudioModal}
        vlcAudioTracks={rnVideoAudioTracks}
        selectedAudioTrack={selectedAudioTrack}
        selectAudioTrack={selectAudioTrack}
      />
      <SubtitleModals
        showSubtitleModal={showSubtitleModal}
        setShowSubtitleModal={setShowSubtitleModal}
        showSubtitleLanguageModal={showSubtitleLanguageModal}
        setShowSubtitleLanguageModal={setShowSubtitleLanguageModal}
        isLoadingSubtitleList={isLoadingSubtitleList}
        isLoadingSubtitles={isLoadingSubtitles}
        customSubtitles={customSubtitles}
        availableSubtitles={availableSubtitles}
        vlcTextTracks={rnVideoTextTracks}
        selectedTextTrack={selectedTextTrack}
        useCustomSubtitles={useCustomSubtitles}
        subtitleSize={subtitleSize}
        fetchAvailableSubtitles={fetchAvailableSubtitles}
        loadWyzieSubtitle={loadWyzieSubtitle}
        selectTextTrack={selectTextTrack}
        increaseSubtitleSize={increaseSubtitleSize}
        decreaseSubtitleSize={decreaseSubtitleSize}
      />
      
      <SourcesModal
        showSourcesModal={showSourcesModal}
        setShowSourcesModal={setShowSourcesModal}
        availableStreams={availableStreams}
        currentStreamUrl={currentStreamUrl}
        onSelectStream={handleSelectStream}
        isChangingSource={isChangingSource}
      />
    </View> 
  );
};

export default AndroidVideoPlayer; 