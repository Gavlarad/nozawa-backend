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
      '20_skyline': { id: 5, name: 'Skyline Double', priority: 2 },
      '17_uenotaira': { id: 6, name: 'Uenotaira Quad', priority: 2 },
      '16_paradise': { id: 7, name: 'Paradise Quad', priority: 2 },
      '15_challenge': { id: 10, name: 'Challenge Double', priority: 3 },
      '14_yutopia': { id: 11, name: 'Utopia Double', priority: 3 },
      '12_kandahar': { id: 12, name: 'Kandahar Double', priority: 3 },
      '4_hikageT': { id: 14, name: 'Hikage Triple', priority: 3 },
      '13_yuroad': { id: 15, name: 'Yu road', priority: 4 },
      '5_hikageF': { id: 16, name: 'Hikage Quad', priority: 3 },
      '7_nagasakaT': { id: 17, name: 'Nagasaka Triple', priority: 3 },
      '23_nagasakaF': { id: 18, name: 'Nagasaka Quad', priority: 2 },
      '9_nagasakaG': { id: 19, name: 'Nagasaka gondola-link Double', priority: 3 },
      '10_karasawa': { id: 20, name: 'Karasawa Double', priority: 3 }
    };
  }

  checkIfSkiSeason() {
    const now = new Date();
    const jstTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
    const month = jstTime.getMonth(); // 0-11
    const day = jstTime.getDate();
    
    // December 10 - April 30 (in JST)
    // Month: 11 = December, 0 = January, 1 = Feb, 2 = March, 3 = April
    return (month === 11 && day >= 10) ||  // Dec 10-31
           (month >= 0 && month <= 2) ||   // All of Jan, Feb, March
           (month === 3 && day <= 30);     // April 1-30
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
      
      // Check if page contains off-season indicators
      const pageHTML = $.html();
      const isOffSeason = pageHTML.includes('営業終了') || 
                         pageHTML.includes('Season finished');
      
      // First try to find lift status from table (more reliable)
      let foundInTable = false;
      $('table').each((i, table) => {
        $(table).find('tr').each((j, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 4) {
            const liftNameText = $(cells[1]).text().trim();
            const hoursText = $(cells[2]).text().trim();
            const statusSymbol = $(cells[3]).text().trim();
            
            // Match lift name to our mappings
            Object.values(this.liftMappings).forEach(liftInfo => {
              if (liftNameText.includes(liftInfo.name) || 
                  liftInfo.name.includes(liftNameText)) {
                
                let status = 'unknown';
                if (hoursText.includes('営業終了')) {
                  status = 'off-season';
                } else if (statusSymbol === '×') {
                  status = isOffSeason ? 'off-season' : 'closed';
                } else if (statusSymbol === '○') {
                  status = 'open';
                }
                
                // Check if lift already added (avoid duplicates)
                if (!lifts.find(l => l.id === liftInfo.id)) {
                  lifts.push({
                    ...liftInfo,
                    status: status,
                    hours: hoursText
                  });
                  foundInTable = true;
                }
              }
            });
          }
        });
      });
      
      // If we didn't find lifts in table, try images (fallback)
      if (!foundInTable) {
        $('img[src*="/lift/"]').each((i, elem) => {
          const src = $(elem).attr('src');
          if (!src) return;
          
          Object.keys(this.liftMappings).forEach(pattern => {
            if (src.includes(pattern)) {
              const lift = this.liftMappings[pattern];
              let status = 'closed';
              
              if (src.includes('_on.gif')) {
                status = 'open';
              } else if (src.includes('_off.gif') && isOffSeason) {
                status = 'off-season';
              }
              
              // Check if lift already added (avoid duplicates)
              if (!lifts.find(l => l.id === lift.id)) {
                lifts.push({
                  ...lift,
                  status: status
                });
              }
            }
          });
        });
      }
      
      // If still no lifts found and it's off-season, return all as off-season
      if (lifts.length === 0 && isOffSeason) {
        Object.values(this.liftMappings).forEach(lift => {
          lifts.push({
            ...lift,
            status: 'off-season',
            hours: '今シーズン 営業終了'
          });
        });
      }
      
      console.log(`Scrape complete. Found ${lifts.length} lifts. Off-season: ${isOffSeason}`);
      
      return {
        lifts: lifts.sort((a, b) => a.priority - b.priority),
        scrapedAt: new Date().toISOString(),
        isOffSeason: isOffSeason,
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
        status: Math.random() > 0.3 ? 'open' : 'closed',
        hours: '8:30-16:30'
      })),
      scrapedAt: new Date().toISOString(),
      testData: true,
      isOffSeason: false
    };
  }
}

module.exports = NozawaLiftScraper;
