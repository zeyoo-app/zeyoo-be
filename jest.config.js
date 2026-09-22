/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@platform/(.*)$': '<rootDir>/src/platform/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  },
};
