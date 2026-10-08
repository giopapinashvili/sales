import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({deviceScaleFactor:1});const svg=await readFile('public/favicon.svg','utf8');await mkdir('public/icons',{recursive:true});for(const [filename,size,padding] of [['icon-192.png',192,0],['icon-512.png',512,0],['maskable-512.png',512,102]]){await page.setViewportSize({width:size,height:size});await page.setContent(`<html><body style="margin:0;background:#305c42;padding:${padding}px;box-sizing:border-box;width:100vw;height:100vh">${svg.replace('<svg ','<svg style="width:100%;height:100%;display:block" ')}</body></html>`);await page.screenshot({path:path.join('public/icons',filename)});}}finally{await browser.close()}
