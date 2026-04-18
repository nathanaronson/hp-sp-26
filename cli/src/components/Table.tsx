import { Box, Text } from "ink";

export type Column<T> = {
  header: string;
  width: number;
  render: (row: T) => string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
};

export function Table<T>({ columns, rows }: Props<T>) {
  return (
    <Box flexDirection="column">
      <Box>
        {columns.map((c) => (
          <Box key={c.header} width={c.width}>
            <Text bold>{c.header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, i) => (
        <Box key={i}>
          {columns.map((c) => (
            <Box key={c.header} width={c.width}>
              <Text>{truncate(c.render(row), c.width - 1)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
