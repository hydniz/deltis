// Public branding endpoint (/api/branding): app name and theme constants.
const express = require('express');
const router = express.Router();
const branding = require('../config/branding');

router.get('/', (req, res) => res.json(branding));

module.exports = router;
