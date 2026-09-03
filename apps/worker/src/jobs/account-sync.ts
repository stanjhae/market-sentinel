export async function runAccountSync(args: {
  force?: boolean;
  sync: (args: { force?: boolean }) => Promise<void>;
}): Promise<void> {
  await args.sync({ force: args.force });
}
