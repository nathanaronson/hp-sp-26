import { Box, Text } from "ink";

export type Column<T> = {
  header: string;
  width: number;
  render: (row: T) => string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  selectedIndex?: number;
};

export function Table<T>({ columns, rows, selectedIndex }: Props<T>) {
  return (
    <Box flexDirection="column">
      <Box>
        {selectedIndex !== undefined ? <Box width={2} /> : null}
        {columns.map((c) => (
          <Box key={c.header} width={c.width}>
            <Text bold>{c.header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, i) => (
        <Box key={i}>
          {selectedIndex !== undefined ? (
            <Box width={2}>
              <Text color={selectedIndex === i ? "cyan" : undefined}>
                {selectedIndex === i ? "›" : " "}
              </Text>
            </Box>
          ) : null}
          {columns.map((c) => (
            <Box key={c.header} width={c.width}>
              <Text color={selectedIndex === i ? "cyan" : undefined}>
                {truncate(c.render(row), c.width - 1)}
              </Text>
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
