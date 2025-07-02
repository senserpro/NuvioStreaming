import axios from 'axios';
import cheerio from 'cheerio';

export async function search(query) {
  // We’ll fill this in later if you want search
  return [];
}

export async function getStreams(imdbId) {
  try {
    // NOTE: replace this with a real Filmizlesene URL later
    const filmUrl = `https://www.fullhdfilmizlesene.so/film/gorevimiz-tehlike-8-son-hesaplasma-izle/`;

    const response = await axios.get(filmUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; scraper)',
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // look for iframe or video embed
    const iframe = $('iframe[src*="rapidvid"]').attr('src');

    if (!iframe) {
      console.log('No rapidvid iframe found');
      return [];
    }

    console.log(`Found iframe: ${iframe}`);

    // Now go to that iframe page
    const iframeResp = await axios.get(iframe, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; scraper)',
      },
    });

    const iframeHtml = iframeResp.data;
    const $iframe = cheerio.load(iframeHtml);

    // find actual video endpoint
    const vodLink = $iframe('source').attr('src');

    if (!vodLink) {
      console.log('No vod link found');
      return [];
    }

    console.log(`VOD link: ${vodLink}`);

    // return Stremio streams
    return [
      {
        title: 'Filmizlesene',
        url: vodLink,
        behaviorHints: { notWebReady: false }
      }
    ];

  } catch (err) {
    console.error(err);
    return [];
  }
}
