const https = require('https');

/**
 * Simple reverse geocoding using OpenStreetMap Nominatim API
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{city?: string, state?: string, country?: string}>}
 */
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1&accept-language=en`;
    
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'MMM-OneDrive/1.0 (https://github.com/hermanho/MMM-OneDrive)',
          'Accept-Language': 'en'
        }
      };
      
      const req = https.get(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const address = json.address;
            resolve({
              city: address?.city || address?.town || address?.village || address?.hamlet,
              state: address?.state,
              country: address?.country
            });
          } catch (error) {
            resolve({});
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({});
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({});
      });
    });
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return {};
  }
};

const testLocations = [
  { name: "New York, USA", lat: 40.7128, lon: -74.0060 },
  { name: "Los Angeles, USA", lat: 34.0522, lon: -118.2437 },
  { name: "Toronto, Canada", lat: 43.6532, lon: -79.3832 },
  { name: "Vancouver, Canada", lat: 49.2827, lon: -123.1207 },
  { name: "London, UK", lat: 51.5074, lon: -0.1278 },
  { name: "Paris, France", lat: 48.8566, lon: 2.3522 },
  { name: "Venice, Italy", lat: 45.4408, lon: 12.3155 }
];

async function testCountryNames() {
  console.log('Testing country names returned by OpenStreetMap Nominatim API:\n');
  
  for (const location of testLocations) {
    console.log(`Testing ${location.name}...`);
    try {
      const result = await reverseGeocode(location.lat, location.lon);
      console.log(`  Country: "${result.country}"`);
      console.log(`  State: "${result.state}"`);
      console.log(`  City: "${result.city}"`);
      console.log();
      
      // Add delay to respect rate limiting
      await new Promise(resolve => setTimeout(resolve, 1100));
    } catch (error) {
      console.log(`  Error: ${error.message}`);
      console.log();
    }
  }
}

testCountryNames().catch(console.error);
