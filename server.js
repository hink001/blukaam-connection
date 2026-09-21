// Root server entry point
// Allows running "node server.js" directly from the root workspace directory
const path = require('path');

// Set current working directory to the bluekamm folder for dotenv and relative assets
process.chdir(path.join(__dirname, 'bluekamm'));

// Launch the BluKaam backend server
require('./bluekamm/server.js');
