const https = require('https');

/**
 * Simple reverse geocoding using OpenStreetMap Nominatim API
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{city?: string, state?: string, country?: string}>}
 */
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1&accept-language=en`;
    
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
            console.log('Full API Response:');
            console.log(JSON.stringify(json, null, 2));
            console.log('\nParsed address components:');
            
            const address = json.address;
            const result = {
              city: address?.city || address?.town || address?.village || address?.hamlet || address?.county,
              state: address?.state,
              country: address?.country
            };
            
            console.log('City:', result.city);
            console.log('State:', result.state);
            console.log('Country:', result.country);
            console.log('\nAll address fields available:');
            if (address) {
              Object.keys(address).forEach(key => {
                console.log(`  ${key}: ${address[key]}`);
              });
            }
            
            resolve(result);
          } catch (error) {
            console.error('JSON parsing error:', error);
            resolve({});
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Request error:', error);
        resolve({});
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        console.log('Request timed out');
        resolve({});
      });
    });
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return {};
  }
};

async function testLocation() {
  console.log('Testing reverse geocoding...\n');
  
  // You can replace these coordinates with yours
  console.log('Please provide your coordinates to test.');
  console.log('Usage: node test-my-location.js <latitude> <longitude>');
  console.log('Example: node test-my-location.js 40.7128 -74.0060\n');
  
  const lat = parseFloat(process.argv[2]);
  const lon = parseFloat(process.argv[3]);
  
  if (isNaN(lat) || isNaN(lon)) {
    console.log('Invalid coordinates provided. Using New York as example:');
    const result = await reverseGeocode(40.7128, -74.0060);
    return;
  }
  
  console.log(`Testing coordinates: ${lat}, ${lon}\n`);
  const result = await reverseGeocode(lat, lon);
  
  console.log('\n=== SUMMARY ===');
  if (result.city || result.state || result.country) {
    const parts = [result.city, result.state, result.country].filter(Boolean);
    console.log(`Final display: "${parts.join(', ')}"`);
  } else {
    console.log(`No city/state/country found. Would show coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }
}

testLocation().catch(console.error);
