window.MathJax = {
    tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']], // Allow inline math
        displayMath: [['$$', '$$'], ['\\[', '\\]']] // Allow block math
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