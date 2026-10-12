import { defineConfig } from 'vitepress';

// VitePress 项目根 = docs/wiki/（仓库 wiki 内容目录原地构建，md 与 .vitepress 同处）。
// 部署到 GitHub Pages 子路径 /ColorblockViewer/wiki/（与主站同仓库名 base）。
export default defineConfig({
  title: 'ColorBlock 模组 Wiki',
  description:
    '面向玩家与进阶用户的 ColorBlock 模组知识库——命令大全、表达式系统、NBT 语法、粒子类型与实战示例',
  base: '/ColorblockViewer/wiki/',
  lang: 'zh-CN',
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/ColorblockViewer/favicon.svg' }]],
  themeConfig: {
    logo: '/ColorblockViewer/favicon.svg',
    nav: [
      { text: '模组 Wiki', link: '/index' },
      { text: '预览工具', link: 'https://yuer159.github.io/ColorblockViewer/' },
      { text: 'GitHub', link: 'https://github.com/YuEr159/ColorblockViewer' },
    ],
    sidebar: [
      {
        text: 'ColorBlock 模组 Wiki',
        items: [
          { text: '总览', link: '/overview' },
          { text: '命令大全', link: '/commands' },
          { text: '表达式系统', link: '/expressions' },
          { text: 'type{NBT} 选项语法', link: '/nbt' },
          { text: '粒子类型清单', link: '/particles' },
          { text: '实战示例', link: '/examples' },
          { text: '常见问题', link: '/faq' },
          { text: '模板库', link: '/templates' },
        ],
      },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    returnToTopLabel: '回到顶部',
    lastUpdatedText: '最后更新',
  },
});