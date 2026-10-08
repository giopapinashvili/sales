import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'*.spec.mjs',workers:1,use:{baseURL:'http://127.0.0.1:8791',channel:'chrome',headless:true},reporter:'list'});
