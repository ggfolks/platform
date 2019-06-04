# Config notes

- Q: Should we call this library tfw.proto and refer to config objects as prototypes ala mvrs?

- Config objects are collections of key/value pairs where the keys are strings and the values are
  of a restricted set of types:

    - basic types: number, string, boolean
    - nested config objects
    - sets of basic types
    - arrays of basic types or nested configs
    - maps from string keys to values of a basic type or nested config object (note that all values
      must have the same type, fundamentally differentiating a map property from a nested config
      property even though they are structurally similar)

- Config objects can inherit from other config objects and data from parent config objects is
  "merged" with child config objects according to a particular policy:

    - basic type valued properties (number, string, boolean) as well as array valued properties
      override any values in parent configs
    - set valued properties are unioned with the values from parent configs
    - map valued properties are merged with the values from parent configs; in the case where both
      a parent and child define the same key, the values are recursively merged per this policy
    - nested config properties are merged recursively, property by property, with their
      corresponding value from parent configs
    - (Q: should type changes (boolean overriding string, record overriding array, etc.) be flagged
      as an error or simply blindly propagated? I lean toward error.)

- Config objects can define associated metadata schemas which describe their contents. These
  metadata will be used to automatically create GUI editors for the config data.

    - the config editor should be built using tfw.ui, not DOM; this is good for dogfooding purposes
      but also enables the tools to be used easily "in game"; it does gate the config editor on the
      creation of tfw.scene2 and tfw.ui, but we can get by with editing .config source files until
      the UI is ready (and perhaps long after)
    - it would be great if we could define the config metadata via a TypeScript interface with
      annotations
