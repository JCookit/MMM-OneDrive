const https = require('https');

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
        res.on('data', (chunk) => data += chunk);
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
      
      req.on('error', () => resolve({}));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({});
      });
    });
  } catch (error) {
    return {};
  }
};

async function quickTest() {
  // Test US
  console.log('US (New York):');
  const us = await reverseGeocode(40.7128, -74.0060);
  console.log(`Country: "${us.country}", State: "${us.state}"`);
  
  await new Promise(resolve => setTimeout(resolve, 1200));
  
  // Test Canada
  console.log('\nCanada (Toronto):');
  const ca = await reverseGeocode(43.6532, -79.3832);
  console.log(`Country: "${ca.country}", State: "${ca.state}"`);
}

quickTest().catch(console.error);
