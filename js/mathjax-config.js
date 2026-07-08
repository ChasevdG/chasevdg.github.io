window.MathJax = {
    tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']], // Allow inline math
        displayMath: [['$$', '$$'], ['\\[', '\\]']], // Allow block math
        packages: {'[+]': ['amsmath']},
        macros: {
            llbracket: "{\\mathopen{\\lbrack\\!\\lbrack}}",
            rrbracket: "{\\mathclose{\\rbrack\\!\\rbrack}}",
            ostar: ["{\\bigcirc\\kern-0.73em\\star}", 0]
        }
    },
    svg: {
        fontCache: 'global'
    }
};

// Re-render MathJax when new content is loaded
function renderMathJax() {
    if (window.MathJax) {
        MathJax.typesetPromise();
    }
}