---
description: "States the coding guidelines to adopt when working with this project."
---

# Coding Guidelines

* Do not interpolate values in the message arg passed to subclasses of ErrorWithData. Instead, pass values via the data arg. Only pass values that are valuable when debugging.
