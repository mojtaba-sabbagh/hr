module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontSize: {
        xs: ['var(--text-caption)', { lineHeight: '1.6' }],
        sm: ['var(--text-body)', { lineHeight: '1.7' }],
        base: ['var(--text-body)', { lineHeight: '1.7' }],
        xl: ['var(--text-section)', { lineHeight: '1.7' }],
        title: ['var(--text-title)', { lineHeight: '1.6' }],
        table: ['var(--text-table)', { lineHeight: '1.7' }],
        menu: ['var(--text-menu)', { lineHeight: '1.7' }],
      },
      fontFamily: { sans: ['var(--font-ui)'] },
      colors: {
        blue:{50:'#f0f7ed',100:'#e1efd9',200:'#c6dfb9',300:'#a4cc90',400:'#68b267',500:'#3fa548',600:'#058240',700:'#086b37',800:'#09552e',900:'#104329'},
        slate:{50:'#f7f9f6',100:'#edf1eb',200:'#d9e1dc',300:'#c3cec7',400:'#627568',500:'#526859',600:'#465a4c',700:'#344b3c',800:'#233c2c',900:'#15271b'},
      },
    },
  },
  plugins: [],
};
