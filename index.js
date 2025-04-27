#!/usr/bin/env node
import axios from 'axios';
import readline from 'readline';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function main() {
  while (true) {
    console.log('\nChoose an option:');
    console.log('a) Update profile');
    console.log('b) Create a post');
    console.log('c) View last 10 posts');
    console.log('e) Exit');
    const choice = await prompt('Enter a, b, c or e: ');

    try {
      if (choice === 'a') {
        const name = await prompt('Name: ');
        const about = await prompt('About: ');
        const picture = await prompt('Picture URL (optional): ');
        const body = { name, about };
        if (picture) body.picture = picture;
        const resp = await axios.post(`${API_BASE}/profile/update`, body);
        console.log('Updated profile:', resp.data);
        try {
          const viewResp = await axios.get(`${API_BASE}/post/view10`);
          console.log('\nLatest 10 events:');
          viewResp.data.forEach((p, i) => {
            console.log(`${i + 1}. [${p.kind}] ${p.content} (id: ${p.id}, created_at: ${p.created_at})`);
          });
        } catch (e) {
          console.error('Error fetching latest events:', e);
        }

      } else if (choice === 'b') {
        const content = await prompt('Post content: ');
        const kindInput = await prompt('Kind (default 1): ');
        const kind = parseInt(kindInput, 10) || 1;
        const resp = await axios.post(`${API_BASE}/post`, { content, kind });
        console.log('Created post:', resp.data);
        try {
          const viewResp = await axios.get(`${API_BASE}/post/view10`);
          console.log('\nLatest 10 events:');
          viewResp.data.forEach((p, i) => {
            console.log(`${i + 1}. [${p.kind}] ${p.content} (id: ${p.id}, created_at: ${p.created_at})`);
          });
        } catch (e) {
          console.error('Error fetching latest events:', e);
        }

      } else if (choice === 'c') {
        const kindInput = await prompt('Kind filter (default 1): ');
        const kind = parseInt(kindInput, 10) || 1;
        const resp = await axios.get(`${API_BASE}/post/view10`, { params: { kind } });
        console.log(`\nLatest 10 posts (kind=${kind}):`);
        resp.data.forEach((p, i) => {
          console.log(`${i + 1}. [${p.created_at}] ${p.content} (id: ${p.id})`);
        });

      } else if (choice === 'e') {
        console.log('Exiting.');
        process.exit(0);

      } else {
        console.log('Invalid selection.');
      }
    } catch (err) {
      if (err.response) {
        console.error('API error:', err.response.data);
      } else {
        console.error('Error:', err.message);
      }
    }
  }
}

main();
