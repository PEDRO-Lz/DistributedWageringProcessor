import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";

const REQUIRED_ROLE = "provider";

const ISSUER_URL =
  process.env.KEYCLOAK_ISSUER_URL ?? "http://localhost:8080/realms/wagering";
const AUDIENCE = process.env.OIDC_AUDIENCE ?? "wagering-api";

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

/**
 * Global (registrado via APP_GUARD em api.module.ts): toda rota exige um JWT
 * válido com a role "provider", exceto as marcadas com @Public(). Valida a
 * assinatura contra a chave pública do Keycloak (JWKS, buscada por HTTP e
 * cacheada por createRemoteJWKSet), nunca guarda segredo aqui
 * client_secret é só do Keycloak pra provider trocar por token, a API só
 * confere assinatura + issuer + audience + role.
 */
@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private readonly jwks = createRemoteJWKSet(
    new URL(`${ISSUER_URL}/protocol/openid-connect/certs`),
  );

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Authorization: Bearer <token> ausente");
    }

    let roles: string[];
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: ISSUER_URL,
        audience: AUDIENCE,
      });
      const realmAccess = payload.realm_access as
        | { roles?: string[] }
        | undefined;
      roles = realmAccess?.roles ?? [];
    } catch {
      throw new UnauthorizedException("token inválido ou expirado");
    }

    if (!roles.includes(REQUIRED_ROLE)) {
      throw new UnauthorizedException(`token sem a role "${REQUIRED_ROLE}"`);
    }
    return true;
  }
}
