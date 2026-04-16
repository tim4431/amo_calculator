# Documentation

This folder contains the project documentation for the browser-deployable AMO calculator architecture.

## Guides

- [Architecture Overview](architecture.md)
  Explains the layered design, the browser execution model, and the contract between Python calculators and the static frontend.

- [Adding A Calculator](adding_a_calculator.md)
  Describes how to add a new calculator to the project, from `core/` computation code to browser registration.

- [Cavity Mode Calculator](cavity_mode_calculator.md)
  A complete end-to-end example based on the cavity-mode calculator, including the solver, the wrapper, the frontend state model, and the plot interaction model.

## Recommended Reading Order

1. Start with [Architecture Overview](architecture.md).
2. Continue with [Adding A Calculator](adding_a_calculator.md).
3. Use [Cavity Mode Calculator](cavity_mode_calculator.md) as the concrete reference implementation.
