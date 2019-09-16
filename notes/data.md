# UDDS Notes

- Specify max size for queues (default to something modest like 64?)
  - Any other form of backpressure?

- Reuse no longer used oids (maybe only after looping around?); make oid a size16

- Change canWrite to be `canWrite (auth :Auth, prop :string, key? :DKey)` and allow fine grained
  map property write checking.

- Add RMap.merge(key, record) for merging partial data onto existing map key; maybe same for Value?

- Come up with some helper for dealing with T|Error reactive sources

- Add "intern" or "token" key type, which will assign 16-bit integers to each word as it goes over
  the wire and decode based on that (maintaining table per connection)
