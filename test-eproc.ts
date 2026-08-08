import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://eproc.tjmg.jus.br/eproc/');
  
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, button')).map(el => ({
      id: el.id,
      name: (el as any).name,
      type: (el as any).type,
      className: el.className,
      text: el.textContent?.trim()
    }));
  });
  
  console.log(JSON.stringify(inputs, null, 2));
  await browser.close();
}

run().catch(console.error);
