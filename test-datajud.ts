import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.DATAJUD_API_KEY;
console.log('Testing DataJud API Key:', apiKey ? 'Key found' : 'Key missing');

async function testDatajud() {
  try {
    const response = await axios.post(
      'https://api-publica.datajud.cnj.jus.br/api_publica_tjmg/_search',
      {
        query: {
          match: {
            "numeroProcesso": "50012345620208130024"
          }
        }
      },
      {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Success! Status:', response.status);
    console.log('Hits:', response.data?.hits?.total?.value);
  } catch (error: any) {
    console.error('Error testing DataJud API:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

testDatajud();
