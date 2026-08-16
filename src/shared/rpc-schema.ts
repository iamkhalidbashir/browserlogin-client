export type RpcPlaceholder<Params = unknown, Result = unknown> = {
  params: Params;
  result: Result;
};

export type RpcSchema = {
  browserlogin: RpcPlaceholder;
};
