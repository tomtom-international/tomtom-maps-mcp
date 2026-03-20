# Coding standards
* Do not interpolate values in the message arg passed to subclasses of ErrorWithData. Instead, pass values via the data arg. Only pass values that are valuable when debugging.
