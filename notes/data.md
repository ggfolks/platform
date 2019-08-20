# UDDS Notes

- Specify max size for queues (default to something modest like 64?)
  - Any other form of backpressure?

- Reuse no longer used oids (maybe only after looping around?); make oid a size16

- Change canWrite to be `canWrite (auth :Auth, prop :string, key? :DKey)` and allow fine grained
  map property write checking.

- Add RMap.merge(key, record) for merging partial data onto existing map key; maybe same for Value?

- Allow record of initial values to be passed when creating DObject

- Come up with some helper for dealing with T|Error reactive sources
