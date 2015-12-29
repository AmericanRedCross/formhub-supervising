//Config stuff
var http = require('http');
var url = require('url');
var moment = require('moment');
var fs = require('fs');
var localConfig = require('../config');
var bcrypt = require('bcrypt-nodejs');
// var PDFImage = require("pdf-image").PDFImage;
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
// var sharp = require('sharp');
var csv = require('csv');

var noFunc = function(){};

function Session(req,res) {
	this.req = req;
	this.res = res;
}

Session.prototype.fail = function(data) {
	console.error("Assets App: Error ("+this.req.connection.remoteAddress+")");
	console.error(data.message);
	data.status = "failure";
	this.res.type("json").status(data.code).write(JSON.stringify(data));
	this.res.end();
}

Session.prototype.success = function(data) {
	console.log("Assets App: Success ("+this.req.connection.remoteAddress+")");
	data.status = "success";
	this.res.type("json").write(JSON.stringify(data));
	this.res.end();
}

Session.prototype.handle = function(err,data,proceed) {
	if (!err) {
		if (proceed) {
			proceed(data);
		}
	} else {
		this.fail({message:err,code:500});
	}
}

//Supporting classes

var userSchema = new Schema({
  username: {type:String,required:true,unique:true},
  password: {type:String,required:true},
  permissions: {type:String,required:true}
},{
	collection:'users'
})

userSchema.index({username:1},{unique:true});

userSchema.methods.generateHash = function(password) {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
};

userSchema.methods.validPassword = function(password) {
    return bcrypt.compareSync(password, this.password);
};

var User = mongoose.model('User',userSchema);

//Application controller
var mongo = require('mongodb');
var Server = mongo.Server,
    Db = mongo.Db,
    BSON = mongo.BSONPure;

function Ctrl(host, port) {
	var that = this;
	this.db = new Db(localConfig.application.db, new Server(host, port, {safe: false}, {auto_reconnect: true}, {}));
	this.db.open(function(err, db) {
		if (err) {
			console.error("Assets App: Error: "+err);
		}
		mongoose.connection.on('open', function () {
			db.collection("users",{strict:true},function(err,collection) {
				if (!collection) {
					var defaultUser = new User();
					defaultUser.username = "default";
					defaultUser.permissions = "super";
					defaultUser.password = defaultUser.generateHash("123");
					defaultUser.save(function(err) {
		                if (err) {
		                	console.error("Could not create default super user");
		                }
		            })
				}
			});
		})

		mongoose.connect('mongodb://localhost/'+localConfig.application.db);

	})
}

Ctrl.prototype.MOID = function(id) {
	return mongo.ObjectID(id);
}

Ctrl.prototype.exportData = function(req,res,type) {
	var ctrl = this;
	var output;
	function complete() {
		res.set('Content-Type', 'text/csv');
		res.set('Content-Disposition', 'attachment; filename="'+type+'-export.csv"');
		res.send(output);
	}
	if (type == "asset") {
		this.getAssets(req.user,{},function(assets) {
			output = ctrl.csvify(assets,assetSchema);
			complete();
		})
	}
	if (type == "user") {
		this.getUsers(function(users) {
			output = ctrl.csvify(users,userSchema);
			complete();
		})
	}
}

Ctrl.prototype.csvify = function(data,schema) {
	var output = "";
	var paths = schema.paths;
	if (schema == userSchema) {
		delete paths.password;
	}
	var keys = Object.keys(paths);
	var displayKeys = [];
	for (var i=0;i<keys.length;i++) {
		displayKeys[i] = '"'+(keys[i].replace(/"/g,'""'))+'"';
	}
	output += displayKeys.join(",")+"\n";
	for (var i=0;i<data.length;i++) {
		var item = data[i];
		var row = [];
		for (var j=0;j<keys.length;j++) {
			var key = keys[j]
			if (key.indexOf(".") != -1) {
				key = key.split(".");
			}
			var val;
			if (typeof key == "object" && key[0] == "tags") {
				val = item[key[0]][key[1]];
			} else {
				val = item[key];
			}
			if (val && typeof val == "object") {
				if (val.length) {
					val = val.join(", ");
				} else {
					val = JSON.stringify(val).replace(/"/g,"");
				}
			}
			if (val && typeof val != "string") {
				val = val.toString();
			}
			val = !val ? '' : val;
			val = '"'+(val.replace(/"/g,'""'))+'"';
			row.push(val);
		}
		row = row.join(",");
		row += "\n";
		output += row;
	}
	return output;
}

Ctrl.prototype.createUser = function(req,res) {
	 User.findOne({ 'username' :  req.body.username }, function(err, user) {
		if (err) { req.flash('createMessage', 'Unable to save a new user account at this time.'); };
		if (user) {
		    req.flash('createMessage', 'There is already an account associated with that username.');
		    res.redirect("/users");
		} else {
			var newUser = new User();
			newUser.username = req.body.username;
			newUser.permissions = req.body.permissions;
			newUser.password = newUser.generateHash(req.body.password);
			newUser.save(function(err) {
                if (err) {
                	req.flash('createMessage', 'Unable to save a new user account at this time.');
                }
                res.redirect("/users");
            })
       	}
   	})
}

Ctrl.prototype.updateUser = function(req,res) {
	User.findOne({ 'username' :  req.params.username }, function(err, user) {
		if (err) { req.flash('editMessage', 'Unable to edit that user account at this time.'); };
		if (user) {
			user.permissions = req.body.permissions;
			if (req.body.password && req.body.password.length > 0) {
				user.password = user.generateHash(req.body.password);
			}
			user.save(function(err) {
                if (err) {
                	req.flash('editMessage', 'Unable to edit that user account at this time.');
                }
                res.redirect("/users");
            })
		} else {
			req.flash('editMessage', 'There is no user account associated with that username.');
		    res.redirect("/users");
       	}
   	})
}

Ctrl.prototype.deleteUser = function(req,res) {
	User.findOne({ 'username' :  req.params.username }, function(err, user) {
		if (err) { req.flash('deleteMessage', 'Unable to delete that user account at this time.'); };
		if (user) {
			user.remove(function(err) {
                if (err) {
                	req.flash('deleteMessage', 'Unable to delete that user account at this time.');
                }
                res.redirect("/users");
            })
		} else {
			req.flash('deleteMessage', 'There is no user account associated with that username.');
		    res.redirect("/users");
       	}
   	})
}

Ctrl.prototype.getUsers = function(callback) {
	var ctrl = this;
	ctrl.db.collection("users", {strict:true}, function(err,collection) {
		if (!err) {
			 collection.find().toArray(function(err,result) {
			 	if (!err) {
			 		callback && callback(result);
			 	} else {
			 		callback && callback([]);
			 	}
			 })
		} else {
			callback && callback([]);
		}
	})
}

Ctrl.prototype.getUser = function(username,callback) {
	User.findOne({username:username}, function(err, user) {
		if (!err && user) {
			callback(user);
		} else {
			callback(undefined);
		}
   	})
}

Ctrl.prototype.importCSV = function(req,res,type) {
	var file = req.files.import;
	if (file.mimetype != "text/csv") {
		res.flash("createMessage","Invalid file type. Please upload a CSV file.");
		res.redirect("/"+type+"s");
	} else {
		var rs = fs.createReadStream(file.path);
		var parser = csv.parse();
		var output = [];
		parser.on("data",function(data) {
			output.push(data);
		})
		parser.on("finish",function() {
			var headers = output.shift();
			var requests = 0;
			var count = 0;
			var errors = [];
			for (var i=0;i<output.length;i++) {
				var row = output[i];
				var newEntity;
				if (type == "asset") {
					newEntity = new Asset();
				} else if (type == "user") {
					newEntity = new User();
				}
				for (var j=0;j<row.length;j++) {
					var cell = row[j];
					var header = headers[j];
					if (/\[*\]/.test(header)) {
						header = header.split("[");
						for (var i=0;i<header.length;i++) {
							header[i] = header[i].replace(/]/g,"");
						}
					}
					if (type == "asset" && (typeof header == "object" && header[0] == "tags")) {
						cell = cell.split(",");
					}
					if (type == "user" || (header != "file" && header != "thumbnail")) {
						if (typeof header == "object") {
							if (!newEntity[header[0]]) {
								newEntity[header[0]] = {};
							}
							newEntity[header[0]][header[1]] = cell;
						} else {
							newEntity[header] = cell;
						}
					}
				}
				if (type == "asset") {
					newEntity.user = req.user.email;
				}
				requests++;
		    	newEntity.save(function(err) {
		    		requests--;
			        if (err) {
			        	if (err.toString().indexOf("E11000") != -1) {
			        		var val = err.toString().split("{ : ")[1].replace(" }","");
			        		if (type == "asset") {
			        			err = "There is already an asset with the title "+val+".";
			        		}
							if (type == "user") {
			        			err = "There is already an account associated with the email address "+val+".";
			        		}

			        	}
			        	errors.push(err);
			        } else {
			        	count++;
			        }
			        if (!requests) {
			        	if (errors.length) {
			        		req.flash("createMessage","<br>"+errors.join("<br>"));
			        	}
			        	if (count > 0) {
			        		req.flash("successMessage","Successfully imported "+count+" "+type+"(s).");
			        	}
			        	res.redirect("/"+type+"s");
			        }
			    })
			}
		})
		rs.pipe(parser);
	}
}

exports.Ctrl = Ctrl;
exports.User = User;
