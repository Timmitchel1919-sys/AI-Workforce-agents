import React from "react";
import "./ui.css";

export interface TableProps {
  caption?: React.ReactNode;
  children?: React.ReactNode;
  empty?: React.ReactNode;
}

export function Table({ caption, children, empty }: TableProps) {
  // Expect consumer to pass semantic <thead>/<tbody> rows
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ui-table">
        {caption ? <caption>{caption}</caption> : null}
        {children}
      </table>
      {empty ? <div>{empty}</div> : null}
    </div>
  );
}

export default Table;
