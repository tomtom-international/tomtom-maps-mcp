/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

// The app entry points import their stylesheet for its side effect and let the
// bundler inline it. TypeScript 7 reports TS2882 for side-effect imports it
// cannot resolve to a module, so declare the CSS wildcard as an opaque module.
declare module "*.css";
