import bcrypt from "bcrypt";

export async function CriarHash(senha, salts) {
  const hash = await bcrypt.hash(senha, salts);
  return hash;
}

export async function CompararHash(senha, hash) {
  const teste = await bcrypt.compare(senha, hash);
  if (teste) {
    return true;
  } else {
    return false;
  }
}
