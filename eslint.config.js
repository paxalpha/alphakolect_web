import alphakolect from '@alphakolect/config/eslint';

const LEGACY = {
  group: ['**/legacy/**'],
  message: 'legacy/ is a read-only reference; do not import from it.',
};

/**
 * Module boundaries of apps/api (TA-10; OPEN-19: "enforced by folder convention + lint"). Each module may use only the
 * modules listed for it — the direction of dependency, which keeps the graph free of cycles — and only through their
 * public entry file, `../<module>/index.js`. Shared code lives in `src/platform`. The composition root
 * (`src/platform/http/app.ts`) wires the modules together and is not a module.
 */
export const MODULE_DEPENDENCIES = {
  health: [],
  audit: [],
  identity: ['audit'],
  tenancy: ['audit', 'identity'],
  platform: ['audit', 'identity', 'tenancy'],
  ledger: ['audit', 'identity', 'tenancy'],
  customers: ['audit', 'identity', 'tenancy'],
  savings: ['audit', 'identity', 'tenancy', 'customers'],
  payments: ['audit', 'identity', 'tenancy'],
};
const MODULES = Object.keys(MODULE_DEPENDENCIES);

const boundaries = MODULES.map((module) => ({
  files: [`apps/api/src/modules/${module}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          LEGACY,
          ...MODULES.filter((other) => other !== module).map((other) =>
            MODULE_DEPENDENCIES[module].includes(other)
              ? {
                  group: [`../${other}/*`, `!../${other}/index.js`],
                  message: `Import the ${other} module only through ../${other}/index.js (TA-10).`,
                }
              : {
                  group: [`../${other}`, `../${other}/*`],
                  message: `The ${module} module may not depend on ${other} (TA-10: ${module} may use ${
                    MODULE_DEPENDENCIES[module].join(', ') || 'no other module'
                  }).`,
                },
          ),
        ],
      },
    ],
  },
}));

export default [...alphakolect, ...boundaries];
