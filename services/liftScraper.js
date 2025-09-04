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
              
              lifts.push({
                ...liftInfo,
                status: status,
                hours: hoursText
              });
              foundInTable = true;
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
            
            lifts.push({
              ...lift,
              status: status
            });
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
    
    return {
      lifts: lifts,
      scrapedAt: new Date().toISOString(),
      isOffSeason: isOffSeason,
      success: true
    };
    
  } catch (error) {
    console.error('Scrape failed:', error.message);
    throw error;
  }
}
