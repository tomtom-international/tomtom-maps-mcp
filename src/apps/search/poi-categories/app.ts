/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import "./styles.css";

const app = new App({ name: "TomTom POI Categories", version: "1.0.0" });

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  // No map visualization for categories — always show the "Data processed" indicator
  hideMapUI();
};

app.connect();
