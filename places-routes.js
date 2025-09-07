const fs = require('fs');

module.exports = function(app) {
  // Unified places endpoint
  app.get('/api/places', (req, res) => {
    try {
      const placesData = JSON.parse(fs.readFileSync('./nozawa_places_unified.json', 'utf8'));
      let places = placesData.places || [];
      
      // Filter by category if requested
      const { category } = req.query;
      if (category) {
        const categories = category.split(',');
        places = places.filter(p => categories.includes(p.category));
      }
      
      res.json({ 
        places,
        total_count: places.length 
      });
    } catch (error) {
      console.error('Error loading places:', error);
      res.status(500).json({ error: 'Failed to load places data' });
    }
  });
};
