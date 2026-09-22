import React from "react";
import "./ui.css";

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  vertical?: boolean;
}

export function Divider({ vertical, ...rest }: DividerProps) {
  if (vertical) return <div className="ui-divider vertical" role="separator" {...rest} />;
  return <hr className="ui-divider" role="separator" {...rest} />;
}

export default Divider;
