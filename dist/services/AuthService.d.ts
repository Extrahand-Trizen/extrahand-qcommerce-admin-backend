export declare class AuthService {
    static login(email: string, password: string): Promise<{
        accessToken: string;
        refreshToken: string;
        user: {
            id: import("mongoose").Types.ObjectId;
            email: string;
            name: string;
            role: "ADMIN" | "SELLER" | "CUSTOMER";
        };
    }>;
    static register(name: string, email: string, password: string): Promise<{
        id: import("mongoose").Types.ObjectId;
        email: string;
        name: string;
        role: "ADMIN" | "SELLER" | "CUSTOMER";
    }>;
    static getMe(userId: string): Promise<{
        id: import("mongoose").Types.ObjectId;
        email: string;
        name: string;
        role: "ADMIN" | "SELLER" | "CUSTOMER";
    }>;
}
