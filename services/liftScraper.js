const cheerio = require('cheerio');
const axios = require('axios');

class NozawaLiftScraper {
  constructor() {
    this.url = 'https://en.nozawaski.com/the-mountain/moutain-info/slopes-lifts/';
    
    this.liftMappings = {
      'new_nagasaka_g': { id: 1, name: 'Nagasaka Gondola', priority: 1 },
      '3_hikageG': { id: 2, name: 'Hikage Gondola', priority: 1 },
      '22_yamabikoF': { id: 3, name: 'Yamabiko Quad', priority: 2 },
      '21_yamabiko02F': { id: 4, name: 'Yamabiko No 2 Quad', priority: 2 },
      '20_skyline': { id: 5, name: 'Skyline Double', priority: 2 }
    };
  }

  async scrape(options = {}) {
    const { forceRun = false } = options;

    try {
      console.log(`Scraping lift status at ${new Date().toISOString()}`);
      
      const { data } = await axios.get(this.url, {
        headers: {
          'User-Agent': 'NozawaGuideApp/1.0'
        },
        timeout: 10000
      });

      const $ = cheerio.load(data);
      const lifts = [];
      
      $('img[src*="/lift/"]').each((i, elem) => {
        const src = $(elem).attr('src');
        if (!src) return;
        
        Object.keys(this.liftMappings).forEach(pattern => {
          if (src.includes(pattern)) {
            const lift = this.liftMappings[pattern];
            lifts.push({
              ...lift,
              status: src.includes('_on.gif') ? 'open' : 'closed'
            });
          }
        });
      });

      return {
        lifts: lifts,
        scrapedAt: new Date().toISOString(),
        success: true
      };
      
    } catch (error) {
      console.error('Scrape failed:', error.message);
      throw error;
    }
  }

  generateTestData() {
    return {
      lifts: Object.values(this.liftMappings).map(lift => ({
        ...lift,
        status: Math.random() > 0.3 ? 'open' : 'closed'
      })),
      scrapedAt: new Date().toISOString(),
      testData: true
    };
  }
}

module.exports = NozawaLiftScraper;
