const cheerio = (await import('cheerio-without-node-native')).default;
const { fetchText } = await import('../src/lib/webstreamer/http.js');

const url = 'https://www.cuevana3.is/ver-pelicula/oppenheimer';
const html = await fetchText(url, { headers: { Referer: 'https://www.cuevana3.is' } }).catch(e => { console.error(e); return ''; });

if (!html) { process.exit(1); }

const $ = cheerio.load(html);
console.log('open_submenu count:', $('.open_submenu').length);
console.log('sub-tab-lang count:', $("ul[class^='sub-tab-lang']").length);
console.log('li[data-tr] count:', $('li[data-tr]').length);

// Check if "latino" appears in text
$('.open_submenu').each((i, el) => {
  const text = $(el).text().toLowerCase().trim();
  const imgLatino = $(el).find("img[src*='latino']").length;
  const srcLatino = $(el).find("[src*='latino']").length;
  console.log(`open_submenu[${i}] text: "${text}" | img latino: ${imgLatino} | src latino: ${srcLatino}`);
  const subUl = $(el).find("ul[class^='sub-tab-lang']");
  console.log(`  sub-tab-lang ul found: ${subUl.length}`);
  subUl.find('li[data-tr]').each((j, li) => {
    console.log(`    li[${j}] data-tr: ${$(li).attr('data-tr').substring(0, 60)}`);
  });
});
