// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// 部署網域：Cloudflare Pages。上線後改成你的自訂網域即可（影響 sitemap / SEO 絕對網址）。
const SITE = process.env.SITE_URL || 'https://guokao-quiz.pages.dev';

export default defineConfig({
  site: SITE,
  integrations: [
    react(),
    sitemap({
      // 只收錄可被搜尋引擎索引的內容頁，排除互動工具頁
      filter: (page) => !/\/(practice|mock|random|records|search)\/?$/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  build: { inlineStylesheets: 'auto' },
});
