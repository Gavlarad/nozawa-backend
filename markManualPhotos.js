const fs = require('fs');

// Load current data
const data = JSON.parse(fs.readFileSync('./nozawa_places_unified.json', 'utf8'));

// Mark all onsens as having manual photos
data.places = data.places.map(place => {
  if (place.category === 'onsen') {
    return {
      ...place,
      manual_photos: true
    };
  }
  return place;
});

// Save updated file
fs.writeFileSync('./nozawa_places_unified.json', JSON.stringify(data, null, 2));

console.log('Added manual_photos flag to all onsens');