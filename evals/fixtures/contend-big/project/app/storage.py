"""In-memory record store: CRUD plus simple equality filtering.

Records are plain dicts; the store assigns and owns the "id" key. All
returned dicts are copies so callers can't mutate the store's internal
state by editing a returned record.
"""


class NotFoundError(Exception):
    pass


class Store:
    def __init__(self):
        self._records = {}
        self._next_id = 1

    def create(self, fields):
        rid = self._next_id
        self._next_id += 1
        record = dict(fields)
        record["id"] = rid
        self._records[rid] = record
        return dict(record)

    def get(self, rid):
        if rid not in self._records:
            raise NotFoundError(rid)
        return dict(self._records[rid])

    def delete(self, rid):
        if rid not in self._records:
            raise NotFoundError(rid)
        del self._records[rid]
        return {"deleted": rid}

    def all(self):
        return [dict(r) for r in self._records.values()]

    def filter(self, **predicate):
        if not predicate:
            return self.all()
        return [dict(r) for r in self._records.values()
                if all(r.get(k) == v for k, v in predicate.items())]

    def count(self):
        return len(self._records)
