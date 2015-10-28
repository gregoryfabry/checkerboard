({
    baseUrl: './',
    out: './build/out.js',
    removeCombined: true,
    wrap: {
      'startFile': './parts/start.frag',
      'endFile': './parts/end.frag',
    },
    optimize: 'none',
    name: 'node_modules/almond/almond.js',
    include: ['stm'],
    paths: {
        'stm': 'src/stm',
        'diffpatch': 'src/diffpatch'
    }
})