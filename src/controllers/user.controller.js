import {asyncHandler} from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js";
import {User} from "../models/user.model.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccesAndRefreshTokens = async(userId) =>
{
    try {
        const user = await User.findById(userId) 
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })

        return {accessToken, refreshToken}

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating and access token")
    }
}

const registerUser = asyncHandler( async(req, res) => {
    // get user detail from frontend
    // validation  - not empty
    // check if user already exists:  username, email 
    //check for images, check for avatar
    // upload them to cloudinary ,   avatar
    //create user object - create entry in db
    //remove password and referse token field from reponse
    //check for user creation
    //return res


    const {fullname, email, username, password} = req.body
    // console.log("email: ", email);

    if(
        [fullname,email,username,password].some((field) => field?.trim() === "")
    ){
        throw new ApiError(400, "all fields requird")
    }
    
   const existedUser = await User.findOne({
        $or: [{username}, {email}]
    })

    if(existedUser){
        throw new ApiError(409, "User with email or username already exits")
    }
    console.log(req.files);

    const avatarLocalPath = req.files?.avatar[0]?.path;
   // const coverImageLocalPath = req.files?.coverImage[0]?.path;
   let coverImageLocalPath;
   if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
    coverImageLocalPath = req.files.coverImage[0].path
   }

    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar file is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!avatar){
        throw new ApiError(400,"Avatar file is required")
    }

    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    return res.status(201).json(
        new ApiResponse(200,createdUser,"User registerted Successfully")
    )
})

const loginUser = asyncHandler( async(req,res) => {
    // req body -> data
    //username or email
    //find the user
    //password check
    //access and refresh token
    //send cookies

    const {email, username, password} = req.body

    if (!username || !email) {
        throw new ApiError(400,"username or email is required")
    }

    const user = await User.findOne({
        $or: [{username},{email}]
    })

    if(!user){
        throw new ApiError(400,"User does not exits")
    }

   const ispasswordCorrect = await user.ispasswordCorrect(password)

   if (!ispasswordCorrect) {
       throw new ApiError(400, " Password is Invalid")
   }

   const {accessToken,refreshToken} = await generateAccesAndRefreshTokens(user._id)

   const loggedInUser = await User.findById(user._id).select("-password  -refreshToken")

   const options = {
    httpOnly: true,
    secure: true
   }

   return res.status(200)
   .cookie("accessToken",accessToken, options)
   .cookie("refreshToken", refreshToken, options)
   .json(
    new ApiResponse(
        200,
        {
            user: loggedInUser, accessToken, refreshToken
        },
        "User logged In Successfully"
    )
   )


})

const logoutUser = asyncHandler( async(req,res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"))
})

const refreshAccessToken = asyncHandler( async(req, res) => {
    const incomimgRefreshToken = req.cookie.refreshToken || req.body.refreshToken

    if(!incomimgRefreshToken){
        throw new ApiError(410,"unauthorized request")
    }

   try {
     const decodedToken = jwt.verify(
         incomimgRefreshToken,
         process.env.REFRESH_TOKEN_SECRET
     )
 
     const user = await User.findById(decodedToken._id)
 
     if(!user){
         throw new ApiError(401,"Invalid refresh Token")
     }
 
     if (incomimgRefreshToken !== user?.refreshToken) {
         throw new ApiError(410,"Refresh token is expired or used")
     }
 
     const options = {
         httpOnly: true,
         secure: true
     }
 
     const {accessToken, newRefreshToken} = await generateAccesAndRefreshTokens(user._id)
 
     return res
     .status(200)
     .console("accessToken", accessToken,options)
     .cookie("refreshToken", newRefreshToken, options)
     .json(
         new ApiResponse(
             200,
             {accessToken, refreshToken: newRefreshToken},
             "Access token refreshed"
 
         )
     )
   } catch (error) {
    throw new ApiError(410, error?.message || "Invalid refresh token")
   }
})

const changeCurrentPassword = asyncHandler(async(eq, res) =>{
    const {oldPassword, newPassword} = req.body

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.ispasswordCorrect(oldPassword)
    if (!isPasswordCorrect) {
        throw new ApiError(400,"old Password is Invalid ")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async(req, res) =>{
    return res
    .status(200)
    .json(new ApiResponse(
        200, req.user,"current user fetched successfully"
    ))
})

const updateAccountDetails = asyncHandler(async(req, res) => {
    const {fullname, email} = req.body

    if(!fullname || !email){
        throw new ApiError(400, "All fields are required")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname,
                email:email
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async(req, res)=> {
    const avatarLocalPath = req.files?.path

    if (!avatarLocalPath) {
        new ApiError(400, "Avatar file is missed")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error while uploading on avatar")
    }

   const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                avatar: avatar.url
            }
        },
        {new: true}
    )

    return res
    .status(200)
    .json(
        new ApiResponse(200, user, "Avatar image updated successfully")
    )
})

const updateCoverImage = asyncHandler(async(req, res)=> {
    const coverImageLocalPath = req.files?.path

    if (!coverLocalPath) {
        new ApiError(400, "coverImage file is missed")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error while uploading on coverImage")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                coverImage: coverImage.url
            }
        },
        {new: true}
    )

    return res
    .status(200)
    .json(
        new ApiResponse(200, user, "Cover image updated successfully")
    )
})

const getUserChannelProfile = asyncHandler(async(req, res) => {
    const {username} = req.params

    if(!username?.trim()){
        throw new ApiError(400, "username is missing")
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()
            },
            $lookup: {
                from: "subscription",
                localField:"_id",
                foreignField: "channel",
                as: "subscriber"
            }
        },
        {
            $lookup: {
                from: "subscription",
                localField:"_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullname: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1

            }
        }
    ])

    if (!channel?.length) {
        throw new ApiError(404, "channel does not exists")
    }

    return res 
    .status(200)
    .json(new ApiResponse(200, channel[0],"User channel fetched successfully"))
})

const getWatchHistory = asyncHandler(async(req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: _id,
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup :{
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullname: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },

                    {
                        $addFields: {
                            ownwer: {
                                $first: "$owner"
                            }
                        }
                    }

                ]
            }
        }
    ])

    return res 
    .status(200)
    .json(new ApiResponse(200,user[0].watchHistory, "Watch history fetched successfully"))
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateCoverImage,
    getUserChannelProfile,
    getWatchHistory
}