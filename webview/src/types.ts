export interface ForeignKeyTarget {
  table: string;
  to: string;
}

export interface GridColumn {
  name: string;
  type: string;
  pk: boolean;
  numeric: boolean;
  fk?: ForeignKeyTarget;
}
