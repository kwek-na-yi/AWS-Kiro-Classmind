# Normalisation

Normalisation organises the columns and tables of a relational database to
reduce data redundancy and improve data integrity. A table is in first normal
form when every column holds a single atomic value and each row is uniquely
identifiable by its key.

Repeating groups are moved into a separate related table, so that no column
stores a list of values. The goal is that every fact is recorded in exactly one
place, which means an update touches one row rather than many.

## Second Normal Form

A table is in second normal form when it is already in first normal form and
every non-key column depends on the whole primary key rather than on part of a
composite key. A dependency on only part of the key is called a partial
dependency.

Partial dependencies are removed by splitting the table, so that each fact is
stored exactly once. This keeps updates cheap and keeps the data consistent
when a row changes.

## Third Normal Form

Third normal form additionally removes transitive dependencies, where a non-key
column depends on another non-key column rather than on the key itself.
Applying it usually means moving a lookup attribute into its own table and
referencing it by key.

A table in third normal form has every non-key column depending on the key, the
whole key, and nothing but the key.

# Indexing

An index speeds up reads and slows down writes, because every index must be
updated whenever the underlying row changes. A covering index answers a query
from the index alone, without touching the table at all.

Each index costs storage and write time, so a table with many indexes is fast
to query and slow to modify. Choosing which columns to index is therefore a
trade-off rather than a free improvement.

# Denormalisation

Denormalisation deliberately reintroduces redundancy to reduce the number of
joins a query must perform. It is the opposite move to normalisation, and it is
chosen for read performance.

The cost is that the same fact is now stored in more than one place, so every
write path must keep those copies consistent or the data drifts apart over
time. Denormalisation trades write complexity for read speed.
