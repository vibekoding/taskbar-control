// Script to create a simple menu bar icon
const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a 32x32 canvas
const canvas = createCanvas(32, 32);
const ctx = canvas.getContext('2d');

// Clear canvas
ctx.clearRect(0, 0, 32, 32);

// Draw a simple "J" for Jira
ctx.fillStyle = '#000000';
ctx.font = 'bold 24px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('J', 16, 16);

// Save as PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('src-tauri/icons/menubar-icon.png', buffer);

console.log('Menu bar icon created successfully!');