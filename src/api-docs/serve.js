'use strict';

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('node:path');

/**
 * Mounts the Swagger UI at /api/docs using the OpenAPI spec in openapi.yaml.
 *
 * @param {import('express').Application} app
 */
function mountApiDocs(app) {
  const spec = YAML.load(path.join(__dirname, 'openapi.yaml'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Mesh API Documentation',
  }));
}

module.exports = { mountApiDocs };
