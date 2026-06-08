const fs = require('fs');
const path = require('path');

// Export highlights query as a string
const HIGHLIGHTS_QUERY = fs.readFileSync(
  path.join(__dirname, 'highlights.scm'),
  'utf8'
);

module.exports = {
  HIGHLIGHTS_QUERY,
};
