#!/usr/bin/env node
const path = require('path');
const { main } = require(path.join(__dirname, '..', 'src', 'main.js'));
main(process.argv);