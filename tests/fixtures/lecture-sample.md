Introductory notes for the relational modelling lecture, written before the
first heading so the extractor has a preamble block to place.

# Database Normalisation

Normalisation organises the columns and tables of a relational database to
reduce data redundancy and improve data integrity. A table is in first normal
form when every column holds a single atomic value and each row is uniquely
identifiable by its key.

Repeating groups are moved into a separate related table so that no column
stores a list of values.

## Second Normal Form

A table is in second normal form when it is in first normal form and every
non-key column depends on the whole primary key rather than on part of a
composite key.

Partial dependencies are removed by splitting the table so that each fact is
stored exactly once.

### Worked example

This third-level heading stays inside the second normal form block, because
only top-level and second-level headings open a new block.

## Third Normal Form

Third normal form additionally removes transitive dependencies, where a
non-key column depends on another non-key column rather than on the key.

# Denormalisation Trade-offs

Denormalisation reintroduces redundancy deliberately to reduce the number of
joins a query must perform. The cost is that the same fact is now stored in
more than one place, so every write path must keep those copies consistent.
